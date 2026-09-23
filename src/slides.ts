export function blankPresentation(title: string) {
  const escaped=title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
  return {xml_presentation:{content:`<presentation xmlns="https://www.larkoffice.com/sml/2.0" width="960" height="540"><title>${escaped}</title></presentation>`}};
}
