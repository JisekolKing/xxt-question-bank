"use strict";

/**
 * 页面识别超时测试（开发工具，不参与插件运行）。
 * 用 VM 加载 popup.js，mock chrome.scripting.executeScript，
 * 不访问浏览器、网络、Cookie 或真实页面。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(ROOT, "popup", "popup.js"),
  "utf8"
);

function createContext() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: "" },
    document: {
      addEventListener() {}
    },
    chrome: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "popup.js" });
  sandbox.collectPageSnapshot = () => ({ url: "https://example.test/" });
  return sandbox;
}

function result(frameId, url) {
  return { frameId, result: { url } };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("withTimeout：正常 Promise 正常返回", async () => {
  const sandbox = createContext();
  const value = await sandbox.withTimeout(Promise.resolve("ok"), 50, "测试");
  assert.strictEqual(value, "ok");
});

test("withTimeout：pending Promise 会超时拒绝", async () => {
  const sandbox = createContext();
  const pending = new Promise(() => {});
  await assert.rejects(
    sandbox.withTimeout(pending, 20, "测试"),
    /测试超时/
  );
});

test("collectSnapshots：正常读取全部框架", async () => {
  const sandbox = createContext();
  const calls = [];
  sandbox.chrome = {
    scripting: {
      async executeScript(options) {
        calls.push(options.target);
        return [result(0, "https://a.test/"), result(1, "https://b.test/")];
      }
    }
  };

  const snapshots = await sandbox.collectSnapshots(1);
  assert.strictEqual(snapshots.length, 2);
  assert.strictEqual(snapshots[0].frameId, 0);
  assert.strictEqual(snapshots[1].frameId, 1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].allFrames, true);
});

test("collectSnapshots：全部框架超时，回退顶层成功", async () => {
  const sandbox = createContext();
  const calls = [];
  sandbox.chrome = {
    scripting: {
      executeScript(options) {
        calls.push(options.target);
        if (options.target.allFrames) {
          return new Promise(() => {});
        }
        return Promise.resolve([result(0, "https://top.test/")]);
      }
    }
  };

  const snapshots = await sandbox.collectSnapshots(1, {
    allFrames: 20,
    top: 50
  });
  assert.strictEqual(snapshots.length, 1);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].allFrames, undefined);
});

test("collectSnapshots：全部框架失败，回退顶层成功", async () => {
  const sandbox = createContext();
  const calls = [];
  sandbox.chrome = {
    scripting: {
      executeScript(options) {
        calls.push(options.target);
        if (options.target.allFrames) {
          return Promise.reject(new Error("allFrames failed"));
        }
        return Promise.resolve([result(0, "https://top.test/")]);
      }
    }
  };

  const snapshots = await sandbox.collectSnapshots(1, {
    allFrames: 20,
    top: 50
  });
  assert.strictEqual(snapshots.length, 1);
  assert.strictEqual(calls.length, 2);
});

test("collectSnapshots：两种方式都超时，最终拒绝而不是永久等待", async () => {
  const sandbox = createContext();
  sandbox.chrome = {
    scripting: {
      executeScript() {
        return new Promise(() => {});
      }
    }
  };

  await assert.rejects(
    sandbox.collectSnapshots(1, { allFrames: 20, top: 20 }),
    /读取顶层页面超时/
  );
});

test("collectSnapshots：两种方式都失败，最终拒绝", async () => {
  const sandbox = createContext();
  sandbox.chrome = {
    scripting: {
      executeScript() {
        return Promise.reject(new Error("execute failed"));
      }
    }
  };

  await assert.rejects(
    sandbox.collectSnapshots(1, { allFrames: 20, top: 20 }),
    /execute failed/
  );
});

test("handleRecognize：识别失败后按钮和加载状态恢复", async () => {
  const sandbox = createContext();
  const elements = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: "",
        hidden: false,
        disabled: false,
        className: "",
        title: "",
        tabIndex: 0,
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        addEventListener() {},
        append() {},
        focus() {}
      });
    }
    return elements.get(id);
  };
  sandbox.cacheElements();
  sandbox.analyzeCurrentTab = async () => {
    throw new Error("页面识别超时");
  };

  await sandbox.handleRecognize();

  assert.strictEqual(elements.get("detect-button").disabled, false);
  assert.strictEqual(
    elements.get("detect-button-label").textContent,
    "识别当前页面"
  );
  assert.strictEqual(elements.get("extract-button").disabled, false);
  assert.strictEqual(elements.get("recognizer-error").hidden, false);
});

(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`  ✓ ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${item.name}`);
      console.error(error);
    }
  }

  console.log(`\n页面识别超时测试：${tests.length - failed}/${tests.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
