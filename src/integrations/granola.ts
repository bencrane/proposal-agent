import { getEnv } from "../config/env";
import type { GranolaNote, GranolaListResponse } from "../types";

const BASE_URL = "https://public-api.granola.ai/v1";

async function granolaFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const env = getEnv();
  if (!env.GRANOLA_API_KEY) {
    throw new Error("GRANOLA_API_KEY not configured");
  }
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${env.GRANOLA_API_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Granola API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function listNotes(opts?: {
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  page_size?: number;
  cursor?: string;
}): Promise<GranolaListResponse> {
  const params: Record<string, string> = {};
  if (opts?.created_after) params.created_after = opts.created_after;
  if (opts?.created_before) params.created_before = opts.created_before;
  if (opts?.updated_after) params.updated_after = opts.updated_after;
  if (opts?.page_size) params.page_size = String(opts.page_size);
  if (opts?.cursor) params.cursor = opts.cursor;
  return granolaFetch<GranolaListResponse>("/notes", params);
}

export async function getNote(noteId: string): Promise<GranolaNote> {
  return granolaFetch<GranolaNote>(`/notes/${noteId}`, { include: "transcript" });
}

export async function findNoteForMeeting(opts: {
  meetingStart: string;
  meetingEnd: string;
  attendeeEmails: string[];
}): Promise<GranolaNote | null> {
  const searchStart = new Date(new Date(opts.meetingStart).getTime() - 30 * 60_000);
  const searchEnd = new Date(new Date(opts.meetingEnd).getTime() + 60 * 60_000);

  const response = await listNotes({
    created_after: searchStart.toISOString(),
    created_before: searchEnd.toISOString(),
    page_size: 10,
  });

  const targetEmails = new Set(opts.attendeeEmails.map((e) => e.toLowerCase()));

  for (const note of response.notes) {
    const fullNote = await getNote(note.id);
    if (fullNote.calendar_event) {
      const noteStart = new Date(fullNote.calendar_event.scheduled_start_time).getTime();
      const calStart = new Date(opts.meetingStart).getTime();
      if (Math.abs(noteStart - calStart) < 5 * 60_000) {
        return fullNote;
      }
    }
    const noteEmails = new Set((fullNote.attendees || []).map((a) => a.email.toLowerCase()));
    const overlap = [...targetEmails].filter((e) => noteEmails.has(e));
    if (overlap.length > 0) {
      return fullNote;
    }
  }

  return null;
}
