"use client";

/**
 * @module use-skill-toast-bridge
 * @description Wires the skill dispatcher's feedback to the toast host.
 *
 * The dispatcher runs outside React and rejects a press with a raw i18n key
 * rather than a sentence, so something mounted has to resolve those keys and
 * show them. Until that happens the notifier is a no-op and every rejection is
 * silent — an operator presses a control, nothing moves, and nothing says why.
 *
 * So any surface that dispatches skills mounts this. It is a global singleton
 * write, safe to mount from whichever surface is on screen.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/ui/toast";
import { setSkillNotifier } from "@/lib/skills";

/**
 * Resolve a fully-qualified key the dispatcher emitted (e.g.
 * "skills.reason.notArmed"), falling back to the key itself so a missing
 * translation degrades to something readable instead of throwing.
 */
export function safeTranslate(
  t: ReturnType<typeof useTranslations>,
  key: string,
): string {
  try {
    return t(key);
  } catch {
    return key;
  }
}

/**
 * A dotted, whitespace-free token is a translation key; anything with spaces is
 * already a sentence and is shown as-is.
 */
const KEY_SHAPE = /^[\w.-]+\.[\w.-]+$/;

/** Route dispatcher notifications through the live toast host. */
export function useSkillToastBridge(): void {
  const { toast } = useToast();
  const t = useTranslations();
  const toastRef = useRef(toast);
  const tRef = useRef(t);

  // Keep the refs current via an effect (never during render) so the notifier
  // closure always reaches the live toast + translator without re-registering.
  useEffect(() => {
    toastRef.current = toast;
    tRef.current = t;
  }, [toast, t]);

  useEffect(() => {
    setSkillNotifier((message, status) => {
      const text = KEY_SHAPE.test(message)
        ? safeTranslate(tRef.current, message)
        : message;
      toastRef.current(text, status ?? "info");
    });
  }, []);
}
