const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

export function detectedTimeZone(fallback = "America/Guayaquil") {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!detected) return fallback;
  try {
    new Intl.DateTimeFormat("es-EC", { timeZone: detected }).format();
    return detected;
  } catch {
    return fallback;
  }
}

function civilParts(instant: Date, timeZone: string) {
  const values = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function parseLocal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError("Fecha y hora local inválida.");
  const [, year, month, day, hour, minute, second = "0"] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const check = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    throw new RangeError("Fecha y hora local inválida.");
  return parts;
}

function sameCivil(left: ReturnType<typeof parseLocal>, right: ReturnType<typeof civilParts>) {
  return Object.keys(left).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

export function zonedDateTimeToIso(value: string, timeZone: string) {
  const local = parseLocal(value);
  const civilUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  let candidate = civilUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = civilParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate += civilUtc - representedUtc;
  }
  const matches = Array.from({ length: 13 }, (_, index) => candidate + (index - 6) * 30 * 60_000)
    .filter((instant) => sameCivil(local, civilParts(new Date(instant), timeZone)))
    .sort((a, b) => a - b);
  if (!matches.length)
    throw new RangeError("La hora indicada no existe en la zona horaria seleccionada.");
  return new Date(matches[0]!).toISOString();
}

export function formatInstantInZone(
  value: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new RangeError("Instante inválido.");
  return new Intl.DateTimeFormat("es-EC", { ...options, timeZone, hour12: false }).format(instant);
}

export function toDateTimeLocalValue(value: string, timeZone: string) {
  const parts = civilParts(new Date(value), timeZone);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function todayInZone(timeZone: string) {
  return toDateTimeLocalValue(new Date().toISOString(), timeZone).slice(0, 10);
}

export function addCivilDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year!, month! - 1, day! + days));
  return result.toISOString().slice(0, 10);
}
