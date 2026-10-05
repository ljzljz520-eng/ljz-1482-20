import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Workbench from "./pages/Workbench";
import SelfCheck from "./pages/SelfCheck";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "react-hot-toast";

const App = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<Workbench />} />
            <Route path="/self-check" element={<SelfCheck />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-right" />
        </Layout>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default App;
