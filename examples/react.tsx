// React integration.

import { useEffect, useState } from 'react';
import { parseDocument, type AnimationDocument } from '@shinkeonkim/clotho';
import { AnimationPlayer, AnimationStage } from '@shinkeonkim/clotho/react';
import '@shinkeonkim/clotho/styles.css';

export function Animation({ id }: { id: string }) {
  const [doc, setDoc] = useState<AnimationDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/animations/${id}.json`);
      const result = parseDocument(await response.json());
      if (cancelled) return;
      // parseDocument returns the issues rather than throwing, so a broken document
      // can say what is wrong instead of rendering as "not found".
      if (result.ok) setDoc(result.document);
      else setError(result.issues.join('\n'));
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <pre className="cloth-error">{error}</pre>;
  if (!doc) return <div className="cloth-placeholder" />;
  return <AnimationPlayer doc={doc} />;
}

/** A frozen frame — no clock, no controls. Useful for a thumbnail or a print view. */
export function Thumbnail({ doc }: { doc: AnimationDocument }) {
  return <AnimationStage doc={doc} time={doc.duration / 2} />;
}

/** Driving the player yourself, for a custom control bar or an editor timeline. */
export function Scrubber({ doc }: { doc: AnimationDocument }) {
  return <AnimationPlayer doc={doc} hideControls strings={{ play: '재생', pause: '일시정지' }} />;
}
