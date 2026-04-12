export function TypingIndicator() {
  return (
    <div class="flex items-center gap-1.5 mt-3">
      <span
        class="w-1 h-1 bg-text-tertiary rounded-full animate-bounce"
        style={{ 'animation-delay': '0ms' }}
      />
      <span
        class="w-1 h-1 bg-text-tertiary rounded-full animate-bounce"
        style={{ 'animation-delay': '150ms' }}
      />
      <span
        class="w-1 h-1 bg-text-tertiary rounded-full animate-bounce"
        style={{ 'animation-delay': '300ms' }}
      />
    </div>
  );
}
