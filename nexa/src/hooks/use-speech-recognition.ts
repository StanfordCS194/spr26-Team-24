"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Stable subscribe + snapshots for useSyncExternalStore: speech-recognition
// support is determined entirely by the runtime environment, never changes
// after mount, and must read `false` during SSR to avoid hydration mismatch.
const subscribe = () => () => {};
const getClientSnapshot = () => getSpeechRecognitionCtor() !== null;
const getServerSnapshot = () => false;

export function useSpeechRecognition() {
  const supported = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinalRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback((onFinal: (text: string) => void) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    // Guard against double-starts — calling start() on an active instance throws.
    if (recognitionRef.current) return;

    onFinalRef.current = onFinal;
    setError(null);

    const recognition = new Ctor();
    recognition.lang =
      typeof navigator !== "undefined" ? navigator.language : "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text) onFinalRef.current?.(text);
        }
      }
    };

    recognition.onerror = (event) => {
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        setError("Microphone permission denied. Please allow access.");
      } else if (event.error === "no-speech") {
        setError("No speech detected. Try again.");
      } else if (event.error === "audio-capture") {
        setError("No microphone found.");
      } else {
        setError("Speech recognition failed. Try again.");
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      onFinalRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      setError("Could not start speech recognition.");
      recognitionRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, error, start, stop };
}
