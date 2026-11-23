import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { OnboardingWizard } from "./components/OnboardingWizard.jsx";
import "./index.css";

const isSetupMode = new URLSearchParams(window.location.search).get("mode") === "setup";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isSetupMode ? <OnboardingWizard /> : <App />}
  </React.StrictMode>
);
