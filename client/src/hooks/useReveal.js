import { useEffect } from "react";

/** Fades in every [data-reveal] element as it scrolls into view. Re-runs per route. */
export default function useReveal(routeKey) {
  useEffect(() => {
    const items = document.querySelectorAll("[data-reveal]:not(.is-visible)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!("IntersectionObserver" in window) || reduceMotion) {
      items.forEach((el) => el.classList.add("is-visible"));
      return undefined;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [routeKey]);
}
