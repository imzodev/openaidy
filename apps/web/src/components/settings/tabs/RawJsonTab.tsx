interface RawJsonTabProps {
  value: () => string;
  onInput: (value: string) => void;
}

export function RawJsonTab(props: RawJsonTabProps) {
  return (
    <div class="flex flex-col flex-1 p-0 h-full">
      <textarea
        value={props.value()}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        class="w-full bg-gray-900 text-gray-100 p-6 font-mono text-sm leading-relaxed border-0 focus:ring-0 rounded-b-lg resize-none min-h-[500px]"
        spellcheck={false}
      />
    </div>
  );
}
