/**
 * Native shell and patch tools write files without asking the editor, so a document the user is
 * editing in Studio could be overwritten underneath an unsaved draft. The editor_* tools check the
 * open session first (EDITOR_SESSION_DIRTY). This is guidance, not enforcement: the external-change
 * conflict in the editor stays the safety net for writes that bypass it.
 */
export const EDITOR_WRITE_GUIDANCE =
  '修改工作空间里的 Markdown、日记、计划等文本文档时，使用 cclink_studio 的 editor_write、editor_append 或 editor_insert，' +
  '不要用 shell 命令、重定向或补丁直接改写：用户可能正在 Studio 编辑器里修改同一文件。' +
  '这些工具在用户有未保存修改时会返回 EDITOR_SESSION_DIRTY 且不写入；收到它时停止写入，请用户先保存或放弃修改后再继续。' +
  '源代码文件仍可使用原生补丁工具。'
