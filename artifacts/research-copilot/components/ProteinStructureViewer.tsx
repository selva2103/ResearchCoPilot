"use client";
/**
 * Phase 5.8A — Mol* viewer. Loaded only via next/dynamic (ssr: false).
 * Loads the backend-supplied (allowlisted) fileUrl; chain focus is best-effort.
 */
import { useEffect, useRef, useState } from "react";
import "molstar/build/viewer/molstar.css";

export default function ProteinStructureViewer({
  fileUrl,
  instanceId,
}: {
  fileUrl: string;
  instanceId: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let plugin: { dispose: () => void } | null = null;

    (async () => {
      try {
        const { createPluginUI } = await import("molstar/lib/mol-plugin-ui");
        const { renderReact18 } = await import("molstar/lib/mol-plugin-ui/react18");
        const { DefaultPluginUISpec } = await import("molstar/lib/mol-plugin-ui/spec");
        if (disposed || !hostRef.current) return;

        const spec = DefaultPluginUISpec();
        const ui = await createPluginUI({
          target: hostRef.current,
          render: renderReact18,
          spec: {
            ...spec,
            layout: { initial: { isExpanded: false, showControls: false } },
          },
        });
        if (disposed) { ui.dispose(); return; }
        plugin = ui;

        const data = await ui.builders.data.download({ url: fileUrl, isBinary: false }, { state: { isGhost: true } });
        const traj = await ui.builders.structure.parseTrajectory(data, "mmcif");
        await ui.builders.structure.hierarchy.applyPreset(traj, "default");

        // Best-effort chain focus (label_asym_id == RCSB asym id).
        if (instanceId) {
          try {
            const { Script } = await import("molstar/lib/mol-script/script");
            const { StructureSelection } = await import("molstar/lib/mol-model/structure");
            const s = ui.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
            if (s) {
              const sel = Script.getStructureSelection(
                (Q) => Q.struct.generator.atomGroups({
                  "chain-test": Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_asym_id(), instanceId]),
                }),
                s
              );
              const loci = StructureSelection.toLociWithSourceUnits(sel);
              if (loci.elements.length > 0) ui.managers.camera.focusLoci(loci);
              else setNote(`Chain ${instanceId} not found in this file; showing the whole entry.`);
            }
          } catch {
            setNote("Could not focus the chain; showing the whole entry.");
          }
        }
        if (!disposed) setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();

    return () => { disposed = true; try { plugin?.dispose(); } catch {} };
  }, [fileUrl, instanceId]);

  return (
    <div className="space-y-1">
      <div ref={hostRef} style={{ position: "relative", width: "100%", height: 360 }} className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden" />
      {status === "loading" && <p className="text-[10px] text-slate-400 italic">Loading 3D viewer…</p>}
      {status === "error" && <p className="text-xs text-amber-600 dark:text-amber-400 italic">⚠️ Could not load this structure in the viewer.</p>}
      {note && <p className="text-[10px] text-slate-400 italic">{note}</p>}
    </div>
  );
}
