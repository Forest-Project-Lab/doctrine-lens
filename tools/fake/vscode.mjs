// 編集器の代わり。session.ts が触る面だけを、素直に作る。
export const l10n = { t: (s, ...a) => a.reduce((x, v, i) => x.split(`{${i}}`).join(v), s) };
export const env = { language: "en" };

export class EventEmitter {
  #handlers = [];
  event = (h) => {
    this.#handlers.push(h);
    return { dispose: () => { this.#handlers = this.#handlers.filter((x) => x !== h); } };
  };
  fire(value) { for (const h of [...this.#handlers]) h(value); }
  dispose() { this.#handlers = []; }
}

export class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = "file"; }
  static file(p) { return new Uri(p); }
  static joinPath(base, ...parts) { return new Uri([base.fsPath, ...parts].join("/")); }
}

export class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

export const state = {
  folders: [],            // 作業フォルダ（fsPath の配列）
  config: {},             // doctrineLens の設定
  contexts: {},           // setContext の記録
};

const watcherEvent = () => (h) => ({ dispose() {} });

export const workspace = {
  get workspaceFolders() {
    return state.folders.map((p) => ({ uri: Uri.file(p) }));
  },
  onDidChangeConfiguration: (h) => ({ dispose() {} }),
  onDidChangeWorkspaceFolders: (h) => { state.onFolders = h; return { dispose() {} }; },
  getConfiguration: (section) => ({
    get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
  }),
  createFileSystemWatcher: () => ({
    onDidChange: watcherEvent(), onDidCreate: watcherEvent(), onDidDelete: watcherEvent(),
    dispose() {},
  }),
};

export const commands = {
  executeCommand: async (name, key, value) => { state.contexts[key] = value; },
};

export const ViewColumn = { One: 1, Two: 2 };
export const hooks = { activeEditor: [], selection: [], posted: [], info: [] };

export const window = {
  /** いま前面にある文章編集器。webview が焦点を取ると編集器の側では undefined になる。 */
  activeTextEditor: undefined,
  showInformationMessage: (m) => { hooks.info.push(m); },
  onDidChangeActiveTextEditor: (h) => { hooks.activeEditor.push(h); return { dispose() {} }; },
  onDidChangeTextEditorSelection: (h) => { hooks.selection.push(h); return { dispose() {} }; },
  createWebviewPanel: (type, title, column, options) => ({
    viewType: type, title, viewColumn: column, options,
    webview: {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: (u) => u,
      postMessage: async (m) => { hooks.posted.push(m); return true; },
      onDidReceiveMessage: (h) => { hooks.receive = h; return { dispose() {} }; },
      options: {},
    },
    onDidDispose: () => ({ dispose() {} }),
    reveal: () => {},
    dispose: () => {},
  }),
};
export class Disposable { constructor(fn) { this.dispose = fn ?? (() => {}); } }
