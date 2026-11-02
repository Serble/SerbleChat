using System.Text;

namespace SerbleChat.Backend.Helpers;

public static class SearchQueryParser {
    /// <summary>
    /// Splits a search box query into terms that must all appear: whitespace separates words and
    /// "double quotes" keep a phrase together. Duplicates (ignoring case) are dropped.
    /// </summary>
    public static List<string> ParseTerms(string query, int maxTerms) {
        List<string> terms = [];
        StringBuilder current = new();
        bool quoted = false;

        void Flush() {
            string term = current.ToString().Trim();
            current.Clear();
            if (term.Length == 0 || terms.Contains(term, StringComparer.OrdinalIgnoreCase)) return;
            terms.Add(term);
        }

        foreach (char c in query) {
            if (c == '"') {
                Flush();
                quoted = !quoted;
            }
            else if (!quoted && char.IsWhiteSpace(c)) {
                Flush();
            }
            else {
                current.Append(c);
            }
        }
        Flush();
        return terms.Count > maxTerms ? terms[..maxTerms] : terms;
    }
}
