# 0003: Eigenes CSS mit Design-Tokens statt Tailwind

Status: akzeptiert

## Kontext

Das Design aus Claude Design steht (Richtung „Markt bunt“, Login in Iteration 2). Offen war, ob das Frontend es mit eigenem CSS auf Basis von Design-Tokens oder mit Tailwind umsetzt (siehe [Roadmap](../roadmap.md)). Das Design ist stark eigen: harte „Sticker“-Schatten, gedrehte Aufkleber, dicke Konturen, je ein Farbsatz für hell und dunkel.

## Entscheidung

- Alle Farben, Abstände, Radien, Schriftgrößen, Konturen und Schatten stehen als CSS Custom Properties in `frontend/src/styles/tokens.css`, mit je einem Satz für hell und dunkel. Das Theme folgt dem System oder einem `data-theme`-Attribut am `<html>`.
- Komponenten stylen sich mit `<style scoped>` und verwenden ausschließlich diese Variablen, keine festen Werte.
- Kein Tailwind und kein anderes CSS-Framework.

## Konsequenzen

- Keine zusätzliche Dependency und kein Build-Schritt für CSS; Vite und Vue bringen Scoped Styles mit.
- Ein Theme-Wechsel braucht kein JavaScript außer dem Setzen von `data-theme`.
- Die Tokens sind die eine Stelle, an der das Design gepflegt wird. Neue Werte aus dem Design kommen zuerst dort hinein.
- Media Queries können keine Variablen lesen. Der Umbruch zwischen Smartphone- und Desktop-Layout steht deshalb als `48rem` in den Komponenten.
