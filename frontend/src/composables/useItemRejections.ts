import { onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'

import { useErrorText } from '@/composables/useErrorMessage'
import { useItemsStore } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'

/**
 * Shows an error toast whenever the server refuses a pending item change of
 * this tab (create, edit, check, delete, remove checked), naming the item
 * (when there is one) and the reason. Mounted once in App.vue so rejections
 * are reported even after leaving the list.
 */
export function useItemRejections(): void {
  const { t } = useI18n()
  const errorText = useErrorText()
  const items = useItemsStore()
  const toasts = useToastsStore()

  const stop = items.onRejected((rejection) =>
    toasts.show({
      kind: 'error',
      text:
        rejection.kind === 'removeChecked'
          ? t('list.rejected.removeChecked')
          : t(`list.rejected.${rejection.kind}`, { name: rejection.name }),
      detail: errorText(rejection.code),
    }),
  )
  onScopeDispose(stop)
}
