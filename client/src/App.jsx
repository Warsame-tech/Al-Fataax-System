import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import SignIn from "./pages/SignIn.jsx";
import Register from "./pages/Register.jsx";
import NotFound from "./pages/NotFound.jsx";
import { RequireAuth } from "./auth/AuthContext.jsx";
import AppLayout from "./app/AppLayout.jsx";
import Dashboard from "./app/Dashboard.jsx";
import ModulePage from "./app/ModulePage.jsx";
import InvoiceView from "./app/InvoiceView.jsx";
import { InvoiceForm } from "./app/pages/Invoices.jsx";
import Receipt from "./app/pages/Receipt.jsx";
import AdminApp from "./admin/AdminApp.jsx";

/*
 * Route map.
 *   Public site:  /  (one page: sections), /signin, /register
 *   Business app: /app (dashboard), /app/m/:id (modules), /app/invoices/:id
 * The API enforces authentication and tenant isolation on every request;
 * RequireAuth only handles navigation.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="signin" element={<SignIn />} />
        <Route path="register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="m/:id" element={<ModulePage />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/preview" element={<InvoiceView preview />} />
        <Route path="sales/:id" element={<Receipt />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
      </Route>

      <Route path="admin/*" element={<AdminApp />} />
    </Routes>
  );
}
