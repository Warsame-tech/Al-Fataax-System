import { Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./pages/SignIn.jsx";
import NotFound from "./pages/NotFound.jsx";
import { RequireAuth } from "./auth/AuthContext.jsx";
import AppLayout from "./app/AppLayout.jsx";
import Dashboard from "./app/Dashboard.jsx";
import ModulePage from "./app/ModulePage.jsx";
import InvoiceView from "./app/InvoiceView.jsx";
import { InvoiceForm } from "./app/pages/Invoices.jsx";
import Receipt from "./app/pages/Receipt.jsx";
import BulkProducts from "./app/BulkProducts.jsx";
import AdminApp from "./admin/AdminApp.jsx";
import OnlineOrder, { OrderTracking } from "./pages/OnlineOrder.jsx";

/*
 * Route map.
 *   Start:        /  -> /signin (the public website is a separate project: /faatix-website; businesses are registered by Faatix)
 *   Business app: /app (dashboard), /app/m/:id (modules), /app/invoices/:id, /app/products/bulk (bulk product registration)
 *   Online ordering (food businesses, no sign-in): /order/:code, /order/:code/track/:tracking
 * The API enforces authentication and tenant isolation on every request;
 * RequireAuth only handles navigation.
 */
export default function App() {
  return (
    <Routes>
      <Route index element={<Navigate to="/signin" replace />} />
      <Route path="signin" element={<SignIn />} />
      <Route path="register" element={<Navigate to="/signin" replace />} />

      <Route path="app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="m/:id" element={<ModulePage />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/:id/edit" element={<InvoiceForm />} />
        <Route path="products/bulk" element={<BulkProducts />} />
        <Route path="invoices/preview" element={<InvoiceView preview />} />
        <Route path="sales/:id" element={<Receipt />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
      </Route>

      <Route path="admin/*" element={<AdminApp />} />
      <Route path="order/:code" element={<OnlineOrder />} />
      <Route path="order/:code/track/:tracking" element={<OrderTracking />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
