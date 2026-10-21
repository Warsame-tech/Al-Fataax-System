import { useEffect, useState } from "react";

/** Returns the id of the section currently in view (scroll-spy). */
export default function useActiveSection(ids, enabled) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!enabled) { setActive(null); return undefined; }
    const sections = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const visible = new Map();

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target.id, e.isIntersecting));
      setActive(ids.find((id) => visible.get(id)) || null);
    }, { rootMargin: "-40% 0px -55% 0px" });

    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [ids, enabled]);

  return active;
}
