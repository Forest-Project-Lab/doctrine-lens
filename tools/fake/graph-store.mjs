// GraphStore の代わり。取得の着地を外から握るためだけの入れ物。
export const control = {
  cleared: 0,
  calls: [],
  /** 呼ばれたら Promise を返す。解決は外から。 */
  handler: null,
};

export class GraphStore {
  #snapshot = null;
  clear() { control.cleared += 1; this.#snapshot = null; }
  markDirty() {}
  get snapshot() { return this.#snapshot; }
  async refresh(projectDir, docsRoot, pluginRoot, options, withAudit) {
    control.calls.push({ projectDir, docsRoot, withAudit });
    const result = await control.handler({ projectDir, docsRoot, withAudit });
    if (result.snapshot) this.#snapshot = result.snapshot;
    return result;
  }
}
