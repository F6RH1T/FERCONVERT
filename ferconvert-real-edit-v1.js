/**
 * FERCONVERT – Gerçek PDF Düzenleme Faz 1
 * ------------------------------------------------------------
 * Bu dosya mevcut editor.html dosyasına sonradan eklenir.
 *
 * Sağladıkları:
 * - Türkçe karakter destekli gömülü Noto Sans fontu
 * - Mevcut PDF metnine çift tıklayarak yerinde düzenleme
 * - Metin alanına göre otomatik yazı küçültme
 * - Çok satırlı metin desteği
 * - Orijinal metni kapatıp yeni metni aynı koordinata işleme
 * - Daha güvenli dosya adı ve hata mesajları
 *
 * Not:
 * Bu Faz 1, PDF içerik akışındaki eski karakter operatörlerini fiziksel olarak
 * silmez. Görsel olarak güvenilir değiştirme yapar. Kalıcı içerik silme/redaksiyon
 * Faz 2'de masaüstü/arka uç PDF motoruyla yapılmalıdır.
 */
(() => {
  'use strict';

  const FONTKIT_URL =
    'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

  const FONT_REGULAR_URL =
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.2.5/files/noto-sans-latin-ext-400-normal.woff';

  const FONT_BOLD_URL =
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.2.5/files/noto-sans-latin-ext-700-normal.woff';

  let fontCache = null;

  function notify(message) {
    if (typeof window.toast === 'function') {
      window.toast(message);
      return;
    }
    console.log('[FERCONVERT]', message);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === src);
      if (existing) {
        if (window.fontkit) resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Kütüphane yüklenemedi: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function fetchBytes(url) {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) {
      throw new Error(`Font indirilemedi (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function getFonts(pdfDocument) {
    if (!window.fontkit) {
      await loadScript(FONTKIT_URL);
    }

    if (!window.fontkit) {
      throw new Error('FontKit başlatılamadı.');
    }

    pdfDocument.registerFontkit(window.fontkit);

    if (!fontCache) {
      fontCache = Promise.all([
        fetchBytes(FONT_REGULAR_URL),
        fetchBytes(FONT_BOLD_URL)
      ]);
    }

    const [regularBytes, boldBytes] = await fontCache;

    const regular = await pdfDocument.embedFont(regularBytes, {
      subset: true
    });

    const bold = await pdfDocument.embedFont(boldBytes, {
      subset: true
    });

    return { regular, bold };
  }

  function hexToRgb(value = '#111827') {
    let v = String(value).replace('#', '').trim();
    if (v.length === 3) {
      v = v.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(v)) {
      v = '111827';
    }

    return [
      parseInt(v.slice(0, 2), 16) / 255,
      parseInt(v.slice(2, 4), 16) / 255,
      parseInt(v.slice(4, 6), 16) / 255
    ];
  }

  function dataUrlToBytes(dataUrl) {
    const parts = String(dataUrl).split(',');
    if (parts.length < 2) {
      throw new Error('Geçersiz görsel verisi.');
    }

    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  function splitLongWord(word, font, size, maxWidth) {
    const chunks = [];
    let current = '';

    for (const char of word) {
      const candidate = current + char;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        chunks.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  function wrapText(text, font, size, maxWidth) {
    const sourceLines = String(text ?? '').replace(/\r/g, '').split('\n');
    const lines = [];

    for (const sourceLine of sourceLines) {
      if (!sourceLine.trim()) {
        lines.push('');
        continue;
      }

      const words = sourceLine.split(/\s+/);
      let current = '';

      for (let word of words) {
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          const chunks = splitLongWord(word, font, size, maxWidth);
          for (const chunk of chunks) {
            const candidate = current ? `${current} ${chunk}` : chunk;
            if (
              current &&
              font.widthOfTextAtSize(candidate, size) > maxWidth
            ) {
              lines.push(current);
              current = chunk;
            } else {
              current = candidate;
            }
          }
          continue;
        }

        const candidate = current ? `${current} ${word}` : word;
        if (
          current &&
          font.widthOfTextAtSize(candidate, size) > maxWidth
        ) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }

      lines.push(current);
    }

    return lines;
  }

  function fitText(text, font, requestedSize, maxWidth, maxHeight) {
    let size = Math.max(6, Number(requestedSize) || 12);
    const minimumSize = 6;

    while (size > minimumSize) {
      const lineHeight = size * 1.2;
      const lines = wrapText(text, font, size, maxWidth);
      if (lines.length * lineHeight <= maxHeight) {
        return { size, lineHeight, lines };
      }
      size -= 0.5;
    }

    const lineHeight = minimumSize * 1.2;
    return {
      size: minimumSize,
      lineHeight,
      lines: wrapText(text, font, minimumSize, maxWidth)
    };
  }

  function drawFittedText(page, object, geometry, fonts) {
    const { rgb } = window.PDFLib;
    const { x, y, w, h, opacity } = geometry;
    const font = object.bold ? fonts.bold : fonts.regular;
    const color = rgb(...hexToRgb(object.color || '#111827'));
    const padding = Math.max(1.5, Math.min(4, h * 0.08));
    const maxWidth = Math.max(4, w - padding * 2);
    const maxHeight = Math.max(4, h - padding * 2);

    const fitted = fitText(
      object.text || '',
      font,
      object.size || 12,
      maxWidth,
      maxHeight
    );

    let baseline = y + h - padding - fitted.size;

    for (const line of fitted.lines) {
      if (baseline < y - fitted.lineHeight) break;

      page.drawText(line, {
        x: x + padding,
        y: baseline,
        size: fitted.size,
        font,
        color,
        opacity
      });

      baseline -= fitted.lineHeight;
    }
  }

  function getObjectGeometry(object, pageWidth, pageHeight) {
    const w = Math.max(1, Number(object.w || 0) * pageWidth);
    const h = Math.max(1, Number(object.h || 0) * pageHeight);
    const x = Number(object.x || 0) * pageWidth;
    const y = pageHeight - Number(object.y || 0) * pageHeight - h;

    return {
      x,
      y,
      w,
      h,
      opacity: object.opacity ?? 1
    };
  }

  async function drawObject(page, object, geometry, fonts, outputDocument) {
    const { rgb } = window.PDFLib;
    const { x, y, w, h, opacity } = geometry;

    if (object.type === 'replacement') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(...hexToRgb(object.cover || '#ffffff')),
        opacity: 1
      });

      drawFittedText(page, object, geometry, fonts);
      return;
    }

    if (object.type === 'text') {
      drawFittedText(page, object, geometry, fonts);
      return;
    }

    if (object.type === 'note') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(1, 0.95, 0.72),
        borderColor: rgb(0.96, 0.62, 0.04),
        borderWidth: 1,
        opacity
      });

      drawFittedText(
        page,
        {
          ...object,
          color: '#1a1a1a',
          size: Math.min(Number(object.size) || 10, 10)
        },
        {
          x: x + 4,
          y: y + 4,
          w: Math.max(4, w - 8),
          h: Math.max(4, h - 8),
          opacity
        },
        fonts
      );
      return;
    }

    if (object.type === 'highlight') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(...hexToRgb(object.color || '#facc15')),
        opacity
      });
      return;
    }

    if (object.type === 'shape') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(...hexToRgb(object.color || '#2563eb')),
        borderWidth: object.width || 2,
        opacity
      });
      return;
    }

    if (object.type === 'image' || object.type === 'signature') {
      const bytes = dataUrlToBytes(object.src);
      let image;

      try {
        image = String(object.src).startsWith('data:image/png')
          ? await outputDocument.embedPng(bytes)
          : await outputDocument.embedJpg(bytes);
      } catch (error) {
        console.warn('Görsel PDF içine eklenemedi:', error);
        return;
      }

      page.drawImage(image, {
        x,
        y,
        width: w,
        height: h,
        opacity
      });
    }
  }

  async function exportPdfPhase1() {
    const state = window.S;

    if (!state?.pdf || !state?.bytes || !Array.isArray(state.pages)) {
      notify('Önce bir PDF açın.');
      return;
    }

    try {
      notify('Türkçe font hazırlanıyor…');

      const {
        PDFDocument,
        degrees
      } = window.PDFLib;

      const sourceDocument = await PDFDocument.load(state.bytes);
      const outputDocument = await PDFDocument.create();
      const fonts = await getFonts(outputDocument);

      notify('PDF düzenlemeleri işleniyor…');

      for (const model of state.pages) {
        if (model.deleted) continue;

        const [copiedPage] = await outputDocument.copyPages(
          sourceDocument,
          [model.index]
        );

        outputDocument.addPage(copiedPage);
        const page = outputDocument.getPage(outputDocument.getPageCount() - 1);

        if (model.rotation) {
          page.setRotation(
            degrees((page.getRotation().angle + model.rotation) % 360)
          );
        }

        const width = page.getWidth();
        const height = page.getHeight();

        for (const object of model.objects || []) {
          const geometry = getObjectGeometry(object, width, height);
          await drawObject(page, object, geometry, fonts, outputDocument);
        }
      }

      const bytes = await outputDocument.save({
        useObjectStreams: true,
        addDefaultPage: false
      });

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const originalName = state.name || 'belge.pdf';

      anchor.href = url;
      anchor.download =
        originalName.replace(/\.pdf$/i, '') + '_ferconvert_faz1.pdf';

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify('PDF Türkçe karakter desteğiyle indirildi.');
    } catch (error) {
      console.error('FERCONVERT Faz 1 dışa aktarma hatası:', error);
      notify(`PDF oluşturulamadı: ${error.message || 'Bilinmeyen hata'}`);
    }
  }

  function openInlineEditor(sourceElement) {
    const state = window.S;
    if (!state?.pages) return;

    const pageIndex = Number(sourceElement.dataset.page);
    const sourceKey =
      `${pageIndex}:${sourceElement.dataset.x}:${sourceElement.dataset.y}`;

    let object = state.pages[pageIndex].objects.find(
      item => item.sourceKey === sourceKey
    );

    if (!object && typeof window.activateExistingText === 'function') {
      window.activateExistingText(sourceElement);
      object = state.pages[pageIndex].objects.find(
        item => item.sourceKey === sourceKey
      );
    }

    if (!object) return;

    const rect = sourceElement.getBoundingClientRect();
    const editor = document.createElement('textarea');

    editor.className = 'fer-inline-text-editor';
    editor.value = object.text || '';
    editor.setAttribute('aria-label', 'PDF metnini düzenle');

    Object.assign(editor.style, {
      position: 'fixed',
      zIndex: '999999',
      left: `${Math.max(8, rect.left)}px`,
      top: `${Math.max(8, rect.top)}px`,
      width: `${Math.max(160, rect.width)}px`,
      minHeight: `${Math.max(54, rect.height + 26)}px`,
      padding: '8px 10px',
      border: '2px solid #12c7ff',
      borderRadius: '8px',
      outline: 'none',
      resize: 'both',
      background: '#ffffff',
      color: '#111827',
      boxShadow: '0 12px 32px rgba(0,0,0,.25)',
      font: '14px/1.35 Inter, Arial, sans-serif'
    });

    const close = (save) => {
      if (!editor.isConnected) return;

      if (save) {
        if (typeof window.pushHistory === 'function') {
          window.pushHistory();
        }

        object.text = editor.value;

        if (typeof window.renderAll === 'function') {
          window.renderAll().then(() => {
            if (typeof window.selectObject === 'function') {
              window.selectObject(object.id, pageIndex);
            }
          });
        }
      }

      editor.remove();
    };

    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        close(true);
      }
    });

    editor.addEventListener('blur', () => close(true), { once: true });

    document.body.appendChild(editor);
    editor.focus();
    editor.select();
  }

  function installInlineEditing() {
    document.addEventListener(
      'dblclick',
      event => {
        const source = event.target.closest?.('.text-source');
        if (!source) return;

        event.preventDefault();
        event.stopPropagation();
        openInlineEditor(source);
      },
      true
    );
  }

  function installHelpfulStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .text-source {
        cursor: text !important;
      }

      .text-source:hover {
        outline: 2px solid rgba(18, 199, 255, .95) !important;
        background: rgba(18, 199, 255, .10) !important;
      }

      .text-source::after {
        content: "Çift tıkla";
        position: absolute;
        left: 0;
        top: -22px;
        padding: 2px 6px;
        border-radius: 5px;
        background: #06131f;
        color: #fff;
        font-size: 10px;
        line-height: 16px;
        opacity: 0;
        pointer-events: none;
        white-space: nowrap;
      }

      .text-source:hover::after {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function installExportOverride() {
    // Mevcut buton işleyicileri fonksiyon adını çalışma anında çağırıyorsa
    // doğrudan bu sürüm kullanılacaktır.
    window.exportPdf = exportPdfPhase1;
    window.exportPdfPhase1 = exportPdfPhase1;

    // Fonksiyona kapalı scope içinden bağlanmış olabilecek butonlar için
    // yaygın butonları yakalayan ek güvenlik katmanı.
    document.addEventListener(
      'click',
      event => {
        const button = event.target.closest?.(
          '#downloadBtn, #exportBtn, [data-action="export"], [data-action="download-pdf"]'
        );

        if (!button) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        exportPdfPhase1();
      },
      true
    );
  }

  function boot() {
    if (!window.PDFLib) {
      console.error('PDFLib bulunamadı. Eklenti editor.html sonunda yüklenmelidir.');
      return;
    }

    installHelpfulStyles();
    installInlineEditing();
    installExportOverride();

    console.info(
      '%cFERCONVERT Faz 1 aktif',
      'background:#06131f;color:#12c7ff;padding:4px 8px;border-radius:4px'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
