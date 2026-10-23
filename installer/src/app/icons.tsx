import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiBrain02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CloudServerIcon,
  Globe02Icon,
  LinkSquare02Icon,
  SecurityLockIcon,
  Alert02Icon,
} from "@hugeicons/core-free-icons"
import type { HugeiconsProps, IconSvgElement } from "@hugeicons/react"

type IconProps = Omit<HugeiconsProps, "icon" | "ref">

function icon(svg: IconSvgElement) {
  return function Icon({ size = "1em", className = "", ...props }: IconProps) {
    return (
      <HugeiconsIcon
        icon={svg}
        size={size}
        className={`hi ${className}`}
        {...props}
      />
    )
  }
}

export const BrainIcon = icon(AiBrain02Icon)
export const ArrowRightIcon = icon(ArrowRight01Icon)
export const XIcon = icon(Cancel01Icon)
export const ServerIcon = icon(CloudServerIcon)
export const GlobeIcon = icon(Globe02Icon)
export const ExternalIcon = icon(LinkSquare02Icon)
export const LockIcon = icon(SecurityLockIcon)
export const WarningIcon = icon(Alert02Icon)
