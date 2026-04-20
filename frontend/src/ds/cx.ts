import { clsx, type ClassValue } from "clsx";

export function cx(...args: ClassValue[]) {
  return clsx(args);
}

export { clsx };
