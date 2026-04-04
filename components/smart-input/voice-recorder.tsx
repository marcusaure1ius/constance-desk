"use client";

import { useState, useRef, useCallback } from "react";
import { transcribeAction } from "@/lib/actions/smart-input";

type RecordingState = "idle" | "recording" | "transcribing";

export function useVoiceRecorder(
  onTranscription: (text: string) => void,
  onError: (error: string) => void
) {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `recording.${ext}`, { type: mimeType });

        setState("transcribing");
        try {
          const formData = new FormData();
          formData.append("file", file);
          const text = await transcribeAction(formData);
          onTranscription(text);
        } catch {
          onError("Не удалось распознать речь");
        } finally {
          setState("idle");
          setDuration(0);
        }
      };

      const MAX_DURATION = 120;
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setState("recording");
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= MAX_DURATION - 1) {
            recorder.stop();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      onError("Нет доступа к микрофону");
    }
  }, [onTranscription, onError]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return {
    state,
    duration,
    formattedDuration: formatTime(duration),
    start,
    stop,
  };
}
