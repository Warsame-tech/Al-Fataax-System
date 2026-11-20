/*
 * Site-wide settings.
 *
 * Contact details are shown in the "Get in touch" section.
 *
 * Images: while a value is null an illustration is shown instead.
 * To use a real photo, put the file in faatix-website/public/images/ and set the path,
 * e.g. aboutImage: "/images/building.jpg".
 */
export const site = {
  contact: {
    phones: ["+252 61 7204265", "+252 61 4323603"],
    emails: ["abdiwahabmire11@gmail.com"]
  },
  aboutImage: "/images/about-building.webp",     // glass building with the Faatix sign
  contactImage: "/images/contact-building.webp"  // office facade with the Faatix sign
};

/* The business app (sign-in) — set VITE_APP_URL when the website and the app live on different domains. */
const APP_URL = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "");
site.appUrl = APP_URL;
site.signInUrl = `${APP_URL}/signin`;
