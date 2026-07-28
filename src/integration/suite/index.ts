// 拡張機能ホストの中で走る試験の入口。mocha を自前で起こす。
import { resolve } from "node:path";

import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: false, timeout: 120000 });
  mocha.addFile(resolve(__dirname, "extension.test.js"));

  return new Promise((resolvePromise, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) reject(new Error(`${failures} 件の試験が落ちた。`));
        else resolvePromise();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
