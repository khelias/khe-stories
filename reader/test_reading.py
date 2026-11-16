import unittest

from reading import CLAUSE_GAP, JOIN_LIMIT, PARAGRAPH_GAP, SENTENCE_GAP, TITLE_GAP, chunks_of, plan, spoken_length

LONG = "Mia ja Liisa kõndisid mööda kitsast rada, mille ääres õitsesid valged karikakrad nagu pisikesed vihmavarjud."
SHORT = "Liisa haigutas."
FIRST = "Väljas kohisesid männid vana unelaulu, tuul liikus vaikselt üle aia ja vana puu, ja kuu paistis aknast pikalt sisse,"
SECOND = "Muri nurrus voodi jalutsis nii tasa, et seda oli rohkem tunda kui kuulda, ning Tuuli ohkas sügavalt põrandal."


class ChunksOf(unittest.TestCase):
    def test_a_short_sentence_is_read_with_the_next(self):
        self.assertEqual(chunks_of(f"{SHORT} {LONG}"), [f"{SHORT} {LONG}"])

    def test_a_short_last_sentence_is_read_with_the_one_before(self):
        self.assertEqual(chunks_of(f"{LONG} {SHORT}"), [f"{LONG} {SHORT}"])

    def test_two_long_sentences_are_read_apart(self):
        self.assertEqual(chunks_of(f"{LONG} {LONG}"), [LONG, LONG])

    def test_a_join_stays_within_the_limit(self):
        short = "Siis tuli öö."
        fits = "Ja " + "a" * (JOIN_LIMIT - len(short) - 5) + "."
        self.assertEqual(chunks_of(f"{fits} {short}"), [f"{fits} {short}"])
        self.assertEqual(chunks_of(f"a{fits} {short}"), [f"a{fits}", short])

    def test_quotes_do_not_count(self):
        self.assertEqual(spoken_length("„Liisa, ärka üles!“"), 17)

    def test_a_name_called_out_is_not_read_alone(self):
        self.assertEqual(chunks_of("„Liisa, ärka üles! Me oleme üksi!“"), ["„Liisa, ärka üles! Me oleme üksi!“"])

    def test_a_too_long_sentence_is_cut_at_its_middle_comma(self):
        self.assertGreater(spoken_length(f"{FIRST} {SECOND}"), JOIN_LIMIT)
        self.assertEqual(chunks_of(f"{FIRST} {SECOND}"), [FIRST, SECOND])

    def test_a_cut_is_never_inside_an_aside(self):
        sentence = (
            "Väljas kohisesid aia taga suured männid vana unelaulu, Muri ühtlane ja tark nurrumine täitis terve toa nagu soe tekk ning kolm "
            "jänesepoega – Mia, Oskar ja seitsmeaastane Liisa – vajusid üheskoos pehmesse ja värvilisse unedemaailma."
        )
        self.assertEqual(chunks_of(sentence)[0], "Väljas kohisesid aia taga suured männid vana unelaulu,")


class Plan(unittest.TestCase):
    def test_a_cut_sentence_pauses_as_at_a_comma(self):
        self.assertEqual([p.gap for p in plan("T", [f"{FIRST} {SECOND}"], "S.")][1:], [TITLE_GAP, CLAUSE_GAP])

    def test_gaps_and_paragraph_starts(self):
        pieces = plan("Kuu akna taga", [f"{LONG} {LONG}", f"{SHORT} {LONG}"], "Unejutt metsast.")
        self.assertEqual(
            [(p.text, p.gap, p.paragraph is not None) for p in pieces],
            [
                ("Kuu akna taga. Unejutt metsast.", 0, False),
                (LONG, TITLE_GAP, True),
                (LONG, SENTENCE_GAP, False),
                (f"{SHORT} {LONG}", PARAGRAPH_GAP, True),
            ],
        )

    def test_a_short_paragraph_never_joins_the_next(self):
        texts = [p.text for p in plan("T", ["Ta tuli lõpuks koju. Ema ja isa!", LONG], "S.")][1:]
        self.assertEqual(texts, ["Ta tuli lõpuks koju. Ema ja isa!", LONG])

    def test_a_quote_ending_a_sentence_ends_it(self):
        quoted = "„See on üks suur seenekuningriik, kus kasvavad kõige suuremad puravikud!“"
        texts = [p.text for p in plan("T", [f"{quoted} {LONG}"], "S.")][1:]
        self.assertEqual(texts, [quoted, LONG])


if __name__ == "__main__":
    unittest.main()
