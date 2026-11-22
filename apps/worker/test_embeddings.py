"""Contract tests with a synthetic tokenizer; these do not establish BGE quality."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("embeddings",Path(__file__).with_name("embeddings.py"))
embeddings=importlib.util.module_from_spec(spec);spec.loader.exec_module(embeddings)


class SyntheticTokenizer:
    model_max_length=20
    def num_special_tokens_to_add(self,pair=False): return 2
    def __call__(self,text,add_special_tokens=False,return_offsets_mapping=False,truncation=False):
        ids=list(range(len(text)))
        if add_special_tokens: ids=[-1]+ids+[-2]
        result={"input_ids":ids}
        if return_offsets_mapping: result["offset_mapping"]=[(i,i+1) for i in range(len(text))]
        return result


class SyntheticModel:
    max_seq_length=20
    tokenizer=SyntheticTokenizer()


class EmbeddingContracts(unittest.TestCase):
    def test_split_obeys_actual_limit_and_preserves_locator(self):
        passage={"id":"original","text":"abcdefghijklmnopqrstuvwxyz0123456789","locator":{"pageIndex":1}}
        split=embeddings.split_passage(passage,SyntheticModel(),"version-one")
        self.assertGreater(len(split),1)
        for part in split:
            self.assertEqual(part["locator"]["pageIndex"],1)
            self.assertLessEqual(len(part["text"])+part["specialTokens"],part["tokenLimit"])
            self.assertEqual(part["text"],passage["text"][part["locator"]["characterStart"]:part["locator"]["characterEnd"]])
        self.assertEqual(split[-1]["locator"]["characterEnd"],len(passage["text"]))

    def test_namespace_stable_but_distinct_between_courses(self):
        passage={"text":"same paragraph","locator":{"pageIndex":0}}
        first=embeddings.split_passage(passage,SyntheticModel(),"version-one")
        same=embeddings.split_passage(passage,SyntheticModel(),"version-one")
        other=embeddings.split_passage(passage,SyntheticModel(),"version-two")
        self.assertEqual(first[0]["id"],same[0]["id"])
        self.assertNotEqual(first[0]["id"],other[0]["id"])

    def test_embedding_shape_and_normalization_checked(self):
        good=[1.0]+[0.0]*383
        self.assertEqual(embeddings.finite_vector(good),good)
        for bad in ([1.0], [0.0]*384, [float("nan")]+[0.0]*383):
            with self.assertRaises(ValueError): embeddings.finite_vector(bad)


if __name__=="__main__":unittest.main()
