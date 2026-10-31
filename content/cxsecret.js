"use strict";

/**
 * 学习通课程题库助手 · cxsecret 字体还原模块
 *
 * 只处理当前页面 CSS 中已经内嵌的 Base64 TTF：
 *   1. 扫描 <style> 中的 @font-face / base64 字体；
 *   2. 用 Typr 解析 cmap/glyf；
 *   3. 对字形路径 JSON 做 MD5，取 25~32 位作为 key；
 *   4. 查本地表得到真实 Unicode，替换假字符；
 *   5. 未命中字符保留原样并标记 complete:false，禁止静默保存乱码。
 *
 * 不读取网络字体、Cookie、Token、隐藏接口。
 */

(function () {
  const TABLE = globalThis.CXSECRET_TABLE || {};
  const FONT_CACHE_KEY = "__CXSECRET_FONT_CACHE__";
  let memoryCache = null;

  // ---------- MD5（与 table.json 的生成算法一致） ----------

  function md5Hex(input) {
    const bytes = new TextEncoder().encode(String(input));
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 8) >>> 6) + 1) << 6;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(bytes);
    buffer[bytes.length] = 0x80;

    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const constants = new Uint32Array(64);
    for (let i = 0; i < 64; i += 1) {
      constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const words = new Uint32Array(16);

    for (let offset = 0; offset < buffer.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) {
        words[i] = view.getUint32(offset + i * 4, true);
      }

      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;

      for (let i = 0; i < 64; i += 1) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) & 15;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) & 15;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) & 15;
        }

        const sum = (f + a + constants[i] + words[g]) >>> 0;
        const rotated = ((sum << shifts[i]) | (sum >>> (32 - shifts[i]))) >>> 0;
        const nextB = (b + rotated) >>> 0;

        a = d;
        d = c;
        c = b;
        b = nextB;
      }

      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    function wordHex(word) {
      let result = "";
      for (let i = 0; i < 4; i += 1) {
        result += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
      }
      return result;
    }

    return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
  }

  // ---------- 字体提取 / 解析 ----------

  function base64ToBytes(base64) {
    const binary = atob(String(base64).replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function findEmbeddedFont() {
    if (typeof document === "undefined") {
      return null;
    }

    const entries = [];
    const styles = document.querySelectorAll("style");

    styles.forEach((style) => {
      const text = style.textContent || "";
      if (!text || !/base64/i.test(text)) {
        return;
      }

      const blocks = text.match(/@font-face\s*\{[^}]*\}/gi) || [];
      const candidates = blocks.length > 0 ? blocks : [text];

      candidates.forEach((block) => {
        const urlMatch =
          /url\(\s*["']?data:[^,]*;base64,([A-Za-z0-9+/=\s]+)["']?\s*\)/i.exec(
            block
          );
        if (!urlMatch) {
          return;
        }
        const familyMatch = /font-family\s*:\s*([^;]+)/i.exec(block);
        entries.push({
          styleId: style.id || "",
          family: familyMatch ? familyMatch[1].trim() : "",
          data: urlMatch[1]
        });
      });
    });

    if (entries.length === 0) {
      return null;
    }

    return (
      entries.find((entry) =>
        /cxsecret|font-cx/i.test(entry.family + " " + entry.styleId)
      ) ||
      entries.find((entry) => entry.styleId === "cxSecretStyle") ||
      entries[0]
    );
  }

  function analyzeFont(bytes) {
    if (!globalThis.Typr || typeof globalThis.Typr.parse !== "function") {
      return null;
    }

    let font;
    try {
      font = globalThis.Typr.parse(bytes)[0];
    } catch (error) {
      console.warn("cxsecret：字体解析失败", error);
      return null;
    }
    if (!font) {
      return null;
    }

    const map = new Map();
    const encoded = new Set();
    let unknown = 0;

    for (let cp = 19968; cp < 40870; cp += 1) {
      const glyphId = globalThis.Typr.U.codeToGlyph(font, cp);
      if (!glyphId) {
        continue;
      }
      encoded.add(cp);
      const path = JSON.stringify(
        globalThis.Typr.U.glyphToPath(font, glyphId)
      );
      const key = md5Hex(path).slice(24);
      const real = TABLE[key];
      if (Number.isInteger(real)) {
        map.set(cp, real);
      } else {
        unknown += 1;
      }
    }

    return {
      map,
      encoded,
      mapped: map.size,
      unknown
    };
  }

  function getFontInfo() {
    if (!globalThis.Typr || Object.keys(TABLE).length === 0) {
      return null;
    }

    const entry = findEmbeddedFont();
    if (!entry) {
      return null;
    }

    // 页面声明了字体但浏览器没有真正加载时，不强行解密。
    if (
      entry.family &&
      typeof document !== "undefined" &&
      document.fonts &&
      typeof document.fonts.check === "function"
    ) {
      const family = entry.family
        .replace(/["']/g, "")
        .split(",")[0]
        .trim();
      if (family) {
        try {
          if (!document.fonts.check(`16px "${family}"`)) {
            return null;
          }
        } catch (error) {
          // 某些浏览器/FontFaceSet 实现可能不支持该 family 名称，继续尝试解析。
        }
      }
    }

    const key = [
      typeof location !== "undefined" && location ? location.href : "",
      entry.data.length,
      entry.data.slice(0, 32),
      entry.data.slice(-32)
    ].join("|");

    if (memoryCache && memoryCache.key === key) {
      return memoryCache.info;
    }
    const persisted = globalThis[FONT_CACHE_KEY];
    if (persisted && persisted.key === key) {
      memoryCache = persisted;
      return persisted.info;
    }

    let info = null;
    try {
      info = analyzeFont(base64ToBytes(entry.data));
    } catch (error) {
      console.warn("cxsecret：内嵌字体读取失败", error);
    }

    memoryCache = { key, info };
    globalThis[FONT_CACHE_KEY] = memoryCache;
    return info;
  }

  // ---------- 文本还原 ----------

  function decodeText(text, info) {
    if (!text || !info || !info.map) {
      return {
        text: text || "",
        complete: false,
        encoded: 0,
        unknown: 0,
        changed: false
      };
    }

    let output = "";
    let encoded = 0;
    let unknown = 0;
    let changed = false;

    for (const char of text) {
      const cp = char.codePointAt(0);
      if (info.map.has(cp)) {
        const real = info.map.get(cp);
        output += String.fromCodePoint(real);
        encoded += 1;
        changed = true;
      } else if (info.encoded.has(cp)) {
        // 字体声明了这个码位，但本地表没有命中：不能猜测。
        output += char;
        encoded += 1;
        unknown += 1;
      } else {
        output += char;
      }
    }

    return {
      text: output,
      complete: unknown === 0,
      encoded,
      unknown,
      changed
    };
  }

  function decodeElement(element, text) {
    if (
      !element ||
      typeof element.closest !== "function" ||
      !element.closest(".font-cxsecret")
    ) {
      return null;
    }
    const info = getFontInfo();
    if (!info) {
      return null;
    }
    return decodeText(text, info);
  }

  globalThis.CXSecret = {
    analyzeFont,
    decodeText,
    decodeElement,
    getFontInfo,
    md5Hex,
    hasTable: Object.keys(TABLE).length
  };
})();
