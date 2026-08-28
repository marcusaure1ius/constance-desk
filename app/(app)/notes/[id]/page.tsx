import { notFound } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment } from "@/lib/services/environments";
import { getNote } from "@/lib/services/notes";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = await getNote(id);

  if (!note) notFound();

  // Заметка из другого проекта — не «не найдена», но и показывать её здесь
  // нельзя: дерево рядом принадлежит активной среде, и они разъедутся.
  const activeEnv = await getActiveEnvironment(await getActiveEnvironmentId());
  if (!activeEnv || note.environmentId !== activeEnv.id) notFound();

  return <NoteEditor note={{ id: note.id, title: note.title, text: note.text }} />;
}
