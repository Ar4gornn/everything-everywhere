import { Route, Routes } from "react-router-dom";

import { GymProvider } from "./gym/GymContext";
import { GymHome } from "./gym/GymHome";
import { GymImport } from "./gym/GymImport";
import { GymSession } from "./gym/GymSession";
import { RoutineEditor } from "./gym/RoutineEditor";

/**
 * The gym (Epic 42, AD-58). Four views under `/gym/*`, all in this one chunk — the live
 * session and the import review must be on the device before the gym has no network, so
 * none of them is a lazy chunk of its own.
 *
 * The data comes from one `useGymData()` (cache first, refreshed when the server answers) and
 * is handed down through `GymProvider`; the live session writes only through its `setActive`.
 */
export function GymPage() {
  return (
    <GymProvider>
      <div className="gym">
        <Routes>
          <Route index element={<GymHome />} />
          <Route path="session" element={<GymSession />} />
          <Route path="import" element={<GymImport />} />
          <Route path="routines/:id" element={<RoutineEditor />} />
          <Route path="*" element={<GymHome />} />
        </Routes>
      </div>
    </GymProvider>
  );
}
