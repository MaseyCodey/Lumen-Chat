export type SchoolLockWindow = {
  id: "morning" | "midday";
  label: string;
  startsAtMinutes: number;
  endsAtMinutes: number;
};

export const mountainTimeZone = "America/Denver";

export const schoolLockWindows: SchoolLockWindow[] = [
  {
    id: "morning",
    label: "9:00 AM to 10:30 AM Mountain Time",
    startsAtMinutes: 9 * 60,
    endsAtMinutes: 10 * 60 + 30
  },
  {
    id: "midday",
    label: "12:00 PM to 2:00 PM Mountain Time",
    startsAtMinutes: 12 * 60,
    endsAtMinutes: 14 * 60
  }
];

export function getMountainClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: mountainTimeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

export function getActiveSchoolLock(date = new Date()) {
  const parts = getMountainClockParts(date);
  const totalMinutes = parts.hour * 60 + parts.minute;
  const activeWindow = schoolLockWindows.find(
    (window) =>
      totalMinutes >= window.startsAtMinutes &&
      totalMinutes < window.endsAtMinutes
  );

  if (!activeWindow) {
    return null;
  }

  return {
    ...activeWindow,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutesUntilUnlock: activeWindow.endsAtMinutes - totalMinutes
  };
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes} min`;
  }

  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}
