const exec = require("./exec");
const { log } = require("./resolve");

/**
 *  Linter interface function.
 *  @param  {TextEditor} texteditor
 *  @return {Promise<Array<Message>>|null}
 */
async function lint(texteditor) {
  // Detached editors are valid providers of unsaved buffer text.
  if (!texteditor || texteditor.isDestroyed()) {
    return null;
  }
  const buffer = texteditor.getBuffer();
  if (!buffer.isAlive()) {
    return null;
  }

  const filepath = texteditor.getPath();
  if (!filepath) {
    return [];
  }
  const projectRoot = atom.project.relativizePath(filepath)[0];

  // Skip files not in a project
  if (!projectRoot) {
    log("Skipping lint outside project:", filepath);
    return [];
  }

  // A tab is not required, but async work must still belong to this file and
  // project when it resumes (for example after closing a project or Save As).
  const isCurrent = () =>
    !texteditor.isDestroyed() &&
    buffer.isAlive() &&
    texteditor.getBuffer() === buffer &&
    texteditor.getPath() === filepath &&
    atom.project.relativizePath(filepath)[0] === projectRoot;

  const engineInfo = await exec.getEngine(projectRoot);
  if (!isCurrent()) {
    return null;
  }
  if (!engineInfo) {
    log("Skipping lint because no ESLint engine is available:", projectRoot);
    return [];
  }

  let ignored = false;
  try {
    ignored = await engineInfo.engine.isPathIgnored(filepath);
  } catch {
    // If isPathIgnored fails, proceed with linting
  }
  if (!isCurrent()) {
    return null;
  }
  if (ignored) {
    log("Skipping ignored file:", filepath);
    return [];
  }

  const fileText = texteditor.getText();
  const report = await exec.exec(filepath, fileText, projectRoot);
  if (!isCurrent()) {
    return null;
  }
  const messages = exec.handle(texteditor, report);
  log("Lint returned messages:", filepath, messages.length);
  return messages;
}

module.exports = { lint };
