import { createEffect, onCleanup, onMount } from 'solid-js';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

type CodeMirrorEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  readOnly?: boolean;
  filePath?: string;
  class?: string;
};

function getLanguageExtension(filePath?: string) {
  const lowerPath = filePath?.toLowerCase() ?? '';

  if (lowerPath.endsWith('.json')) {
    return json();
  }

  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
    return markdown();
  }

  if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
    return html();
  }

  if (lowerPath.endsWith('.css')) {
    return css();
  }

  if (
    lowerPath.endsWith('.ts') ||
    lowerPath.endsWith('.tsx') ||
    lowerPath.endsWith('.js') ||
    lowerPath.endsWith('.jsx')
  ) {
    return javascript({ typescript: true, jsx: true });
  }

  return [];
}

export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let hostRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  const languageCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  const applyExternalValue = () => {
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === props.value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: props.value,
      },
    });
  };

  onMount(() => {
    if (!hostRef) {
      return;
    }

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageCompartment.of(getLanguageExtension(props.filePath)),
        readOnlyCompartment.of(
          EditorState.readOnly.of(props.readOnly ?? false),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            props.onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            'font-size': '14px',
          },
          '.cm-scroller': {
            overflow: 'auto',
            'font-family':
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: hostRef,
    });
  });

  createEffect(() => {
    if (!view) {
      return;
    }

    view.dispatch({
      effects: readOnlyCompartment.reconfigure(
        EditorState.readOnly.of(props.readOnly ?? false),
      ),
    });
  });

  createEffect(() => {
    if (!view) {
      return;
    }

    view.dispatch({
      effects: languageCompartment.reconfigure(
        getLanguageExtension(props.filePath),
      ),
    });
  });

  createEffect(() => {
    applyExternalValue();
  });

  onCleanup(() => {
    view?.destroy();
    view = undefined;
  });

  return <div ref={hostRef} class={`h-full w-full ${props.class ?? ''}`} />;
}
