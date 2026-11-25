// Deliberately defective disposable fixture, never an application dependency.
export const clamp = (value, lower, upper) => Math.min(upper, value);
