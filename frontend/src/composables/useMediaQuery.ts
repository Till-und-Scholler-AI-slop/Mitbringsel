import { onScopeDispose, readonly, ref, type Ref } from 'vue'

// Whether a CSS media query matches, kept up to date while the window
// changes. Without matchMedia (jsdom in tests) it is always false.
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
  const matches = ref(media?.matches ?? false)

  if (media) {
    const update = (event: MediaQueryListEvent) => {
      matches.value = event.matches
    }
    media.addEventListener('change', update)
    onScopeDispose(() => media.removeEventListener('change', update))
  }

  return readonly(matches)
}
