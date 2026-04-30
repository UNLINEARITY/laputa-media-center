import { SectionCard } from '@/components/guide/section-card'
import { DeliveryPackagePanel } from '@/components/jobs/delivery-package-panel'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'

interface DeliveryPackageSectionProps {
  deliveryPackage: DeliveryPackage
}

export function DeliveryPackageSection({ deliveryPackage }: DeliveryPackageSectionProps) {
  return (
    <section id="delivery-package">
      <SectionCard title="交付包">
        <DeliveryPackagePanel
          deliveryPackage={deliveryPackage}
          gridClassName="mt-4 sm:grid-cols-2 xl:grid-cols-2"
          titleClassName="text-claude-dark-800"
          subtitleClassName="text-claude-dark-500"
          variant="claude"
        />
      </SectionCard>
    </section>
  )
}
