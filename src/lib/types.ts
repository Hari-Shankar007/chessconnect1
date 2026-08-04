export type Role = "student" | "coach";

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
  image_url: string | null;
}

export interface Chat {
  id: string;
  student_id: string;
  coach_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  file_url: string | null;
  file_type: "pdf" | "image" | null;
  file_name: string | null;
  created_at: string;
}

export interface ChatPartner {
  chat_id: string;
  student_id: string;
  student_name: string;
  student_image: string | null;
  last_content: string | null;
  last_file_type: "pdf" | "image" | null;
  last_sender_id: string | null;
  last_created_at: string | null;
}

export interface Article {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  image_url: string | null;
  created_at: string;
  created_by: string;
}

export interface Tournament {
  id: string;
  title: string;
  link_url: string;
  event_date: string;
  description: string | null;
  created_at: string;
  created_by: string;
}

export interface RatingEntry {
  id: string;
  student_id: string;
  rating: number;
  month: string;
  period: "weekly" | "monthly";
  created_at: string;
  created_by: string;
}

export interface Worksheet {
  id: string;
  student_id: string;
  title: string;
  completed: boolean;
  assigned_at: string;
  deadline: string | null;
  created_at: string;
  created_by: string;
}

export interface GamesPlayed {
  id: string;
  student_id: string;
  count: number;
  month: string;
  created_at: string;
  created_by: string;
}

export interface TournamentParticipation {
  id: string;
  student_id: string;
  tournament_id: string | null;
  title: string;
  played_at: string;
  created_at: string;
  created_by: string;
}
