import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import "./App.css";
import "./i18n";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* @ts-expect-error react-router-dom v6 type mismatch with React 19 */}
    <RouterProvider router={router} />
  </React.StrictMode>,
);
