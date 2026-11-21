import { onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'

import { useErrorText } from '@/composables/useErrorMessage'
import { useItemsStore } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'

/**
 * Shows an error toast whenever the server refuses a pending item change of
 * this tab (create, edit, check, delete), naming the item and the reason.
 * Mounted once in App.vue so rejections are reported even after leaving the
 * list.
 */
export function useItemRejections(): void {
  const { t } = useI18n()
  const errorText = useErrorText()
  const items = useItemsStore()
  const toasts = useToastsStore()

  const stop = items.onRejected(({ kind, name, code }) =>
    toasts.show({
      kind: 'error',
      text: t(`list.rejected.${kind}`, { name }),
      detail: errorText(code),
    }),
  )
  onScopeDispose(stop)
}
