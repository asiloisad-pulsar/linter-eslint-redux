/* eslint-env jasmine */
const os = require("os");
const path = require("path");
const exec = require("../lib/exec");
const { lint } = require("../lib/lint");

function deferred() {
  let resolve;
  const promise = new Promise((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
}

describe("ESLint file linting", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const otherProjectRoot = os.tmpdir();
  const source = "const answer = missing;\n";
  const report = {
    results: [
      {
        messages: [
          { line: 1, column: 16, message: "Undefined", ruleId: "no-undef", severity: 2 },
        ],
      },
    ],
  };
  let previousPaths;
  let editors;
  let engine;

  beforeEach(() => {
    previousPaths = atom.project.getPaths();
    atom.project.setPaths([projectRoot, otherProjectRoot]);
    editors = [];
    engine = { isPathIgnored: () => Promise.resolve(false) };
    spyOn(exec, "getEngine").andReturn(Promise.resolve({ engine }));
    spyOn(exec, "exec").andReturn(Promise.resolve(report));
    spyOn(exec, "handle").andCallThrough();
  });

  afterEach(() => {
    for (const editor of editors) {
      if (!editor.isDestroyed()) {
        editor.destroy();
      }
    }
    atom.project.setPaths(previousPaths);
  });

  function createEditor(root = projectRoot) {
    const editor = atom.workspace.buildTextEditor();
    editor.getBuffer().setPath(path.join(root, "detached.js"));
    editor.setText(source);
    editors.push(editor);
    return editor;
  }

  it("lints unsaved text from an editor with no workspace tab", async () => {
    const editor = createEditor();
    expect(atom.workspace.getTextEditors().includes(editor)).toBe(false);

    const messages = await lint(editor);

    expect(exec.exec).toHaveBeenCalledWith(editor.getPath(), source, projectRoot);
    expect(messages.length).toBe(1);
    expect(messages[0].excerpt).toBe("no-undef: Undefined");
    expect(messages[0].location.file).toBe(editor.getPath());
  });

  it("uses each detached editor's own project root", async () => {
    const firstEditor = createEditor();
    const secondEditor = createEditor(otherProjectRoot);

    await Promise.all([lint(firstEditor), lint(secondEditor)]);

    expect(exec.getEngine).toHaveBeenCalledWith(projectRoot);
    expect(exec.getEngine).toHaveBeenCalledWith(otherProjectRoot);
    expect(exec.exec).toHaveBeenCalledWith(firstEditor.getPath(), source, projectRoot);
    expect(exec.exec).toHaveBeenCalledWith(secondEditor.getPath(), source, otherProjectRoot);
  });

  it("skips destroyed editors and buffers", async () => {
    const destroyedEditor = createEditor();
    destroyedEditor.destroy();
    const destroyedBufferEditor = createEditor();
    destroyedBufferEditor.getBuffer().destroy();

    expect(await lint(destroyedEditor)).toBe(null);
    expect(await lint(destroyedBufferEditor)).toBe(null);
    expect(exec.getEngine).not.toHaveBeenCalled();
  });

  it("skips files outside the current projects", async () => {
    const editor = createEditor();
    editor.getBuffer().setPath(path.resolve(projectRoot, "..", "outside.js"));

    expect(await lint(editor)).toEqual([]);
    expect(exec.getEngine).not.toHaveBeenCalled();
  });

  it("skips a removed project after its engine finishes loading", async () => {
    const editor = createEditor();
    const loadingEngine = deferred();
    exec.getEngine.andReturn(loadingEngine.promise);

    const pending = lint(editor);
    atom.project.setPaths([otherProjectRoot]);
    loadingEngine.resolve({ engine });

    expect(await pending).toBe(null);
    expect(exec.exec).not.toHaveBeenCalled();
  });

  it("skips a renamed file after its ignore check finishes", async () => {
    const editor = createEditor();
    const checkingIgnore = deferred();
    const beganIgnore = deferred();
    spyOn(engine, "isPathIgnored").andCallFake(() => {
      beganIgnore.resolve();
      return checkingIgnore.promise;
    });

    const pending = lint(editor);
    await beganIgnore.promise;
    editor.getBuffer().setPath(path.join(projectRoot, "renamed.js"));
    checkingIgnore.resolve(false);

    expect(await pending).toBe(null);
    expect(exec.exec).not.toHaveBeenCalled();
  });

  async function beginPendingReport(editor) {
    const pendingReport = deferred();
    const beganReport = deferred();
    exec.exec.andCallFake(() => {
      beganReport.resolve();
      return pendingReport.promise;
    });
    const pending = lint(editor);
    await beganReport.promise;
    return { pending, pendingReport };
  }

  it("does not handle a report after its buffer is destroyed", async () => {
    const editor = createEditor();
    const { pending, pendingReport } = await beginPendingReport(editor);
    editor.getBuffer().destroy();
    pendingReport.resolve(report);

    expect(await pending).toBe(null);
    expect(exec.handle).not.toHaveBeenCalled();
  });

  it("does not handle a report after its project is removed", async () => {
    const editor = createEditor();
    const { pending, pendingReport } = await beginPendingReport(editor);
    atom.project.setPaths([otherProjectRoot]);
    pendingReport.resolve(report);

    expect(await pending).toBe(null);
    expect(exec.handle).not.toHaveBeenCalled();
  });
});
