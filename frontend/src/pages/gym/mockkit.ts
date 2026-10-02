import { vi } from "vitest";

/** The fakes the gym tests share. Imports nothing from the app: a `vi.mock` factory loads this,
 *  and a cycle through `api/client` would wait on itself forever. */

export const USER_ID = "u1";

export const mocks = {
  completeWorkout: vi.fn(),
  listRoutinesFull: vi.fn(),
  listExercises: vi.fn(),
  listWorkouts: vi.fn(),
  exerciseHistory: vi.fn(),
  createRoutine: vi.fn(),
  updateRoutine: vi.fn(),
  importRoutine: vi.fn(),
  reorderRoutine: vi.fn(),
  addRoutineLine: vi.fn(),
  updateRoutineLine: vi.fn(),
  removeRoutineLine: vi.fn(),
  deleteRoutine: vi.fn(),
  readWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
  updateExercise: vi.fn(),
};

export function mockClient(real: Record<string, unknown>) {
  const api = real.api as Record<string, unknown>;
  return { ...real, api: { ...api, ...mocks } };
}

export function authModule() {
  const user = { id: USER_ID, email: "sam@example.com", weight_unit: "kg", language: "en" };
  const auth = { user };
  return {
    useAuth: () => auth,
    useOptionalAuth: () => auth,
    AuthProvider: ({ children }: { children: unknown }) => children,
  };
}

