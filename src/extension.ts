import * as vscode from 'vscode';
import { formatSql } from './formatter';

function getOptions(): { indentSize: number; additionalFunctions: string[] } {
  const cfg = vscode.workspace.getConfiguration('sqlRiverStyle');
  return {
    indentSize: cfg.get<number>('indentSize', 4),
    additionalFunctions: cfg.get<string[]>('additionalFunctions', []),
  };
}

function formatDocument(document: vscode.TextDocument): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = formatSql(original, getOptions());
  if (formatted === original) {
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length),
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerDocumentFormattingEditProvider('sql', {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
      return formatDocument(document);
    },
  });

  const command = vscode.commands.registerCommand('sqlRiverStyle.format', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (editor.document.languageId !== 'sql') {
      vscode.window.showWarningMessage('SQL River Style: the active file is not a SQL document.');
      return;
    }
    const edits = formatDocument(editor.document);
    if (edits.length === 0) {
      return;
    }
    await editor.edit((editBuilder) => {
      for (const edit of edits) {
        editBuilder.replace(edit.range, edit.newText);
      }
    });
  });

  context.subscriptions.push(provider, command);
}

export function deactivate(): void {
  // nada a limpar
}
