import type { ComponentProps } from "react";

/**
 * Plain <img> on purpose: cover images live on whatever origin the Storage
 * bucket or a pasted URL uses, which next/image would need to allow-list.
 */
export function RemoteImage(props: ComponentProps<"img">) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img loading="lazy" decoding="async" {...props} alt={props.alt ?? ""} />;
}
