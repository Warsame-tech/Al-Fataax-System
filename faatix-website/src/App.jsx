import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import NotFound from "./pages/NotFound.jsx";

/*
 * The public website: one page of sections (/#features, /#pricing, /#contact …).
 * Signing in happens in the business app (site.signInUrl); new businesses are registered by Faatix,
 * so "Request a demo" opens the contact form, which lands in Super admin → Support → Website messages.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
