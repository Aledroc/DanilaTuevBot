import sys
import unittest
from unittest.mock import MagicMock, patch

import inventory
import chat_manager

class TestShopItemsAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.user_id = 999999991
        cls.chat_id = -1001234567890
        inventory.add_coins(cls.user_id, 20000, reason="test_setup")

    def test_01_catalog_integrity(self):
        """Проверяем, что все 14 товаров присутствуют в каталоге SHOP_ITEMS."""
        shop_items = inventory.get_shop_items()
        item_ids = {it["item_id"] for it in shop_items}
        expected_ids = {
            "vip_badge",
            "slap_friend",
            "custom_roast",
            "golden_fart",
            "silent_muter",
            "compliment_bomb",
            "dungeon_party",
            "fake_ban",
            "bot_whisper",
            "paranoia_mode",
            "shout_announcement",
            "dungeon_immunity",
            "mood_override",
            "custom_title",
        }
        self.assertTrue(expected_ids.issubset(item_ids), f"Missing items: {expected_ids - item_ids}")
        print("✓ Catalog integrity verified: all 14 items present.")

    def test_02_aliases_resolution(self):
        """Проверяем, что синонимы (gossip, rumor, secret, mood_change) успешно резолвятся."""
        res_gossip = inventory.buy_shop_item(self.user_id, "gossip", chat_id=self.chat_id, extra_data={"gossip": "Тестовая сплетня"})
        self.assertTrue(res_gossip["success"], f"Failed buy gossip: {res_gossip}")
        self.assertEqual(res_gossip["item_id"], "bot_whisper")

        res_secret = inventory.buy_shop_item(self.user_id, "secret", chat_id=self.chat_id)
        self.assertTrue(res_secret["success"])
        self.assertEqual(res_secret["item_id"], "bot_whisper")
        print("✓ Aliases (gossip/secret -> bot_whisper) successfully verified.")

    def test_03_one_time_items_not_polluting_perks(self):
        """Проверяем, что одноразовые товары не сохраняются в постоянных user_perks."""
        perks = inventory.get_user_perks(self.user_id, chat_id=self.chat_id)
        active_perk_ids = [p["perk_id"] for p in perks.get("perks", [])]
        self.assertNotIn("bot_whisper", active_perk_ids)
        self.assertNotIn("golden_fart", active_perk_ids)
        self.assertNotIn("compliment_bomb", active_perk_ids)
        self.assertNotIn("slap_friend", active_perk_ids)
        self.assertNotIn("fake_ban", active_perk_ids)
        self.assertNotIn("shout_announcement", active_perk_ids)
        print("✓ One-time items perk pollution prevention verified.")

    def test_04_long_term_perks(self):
        """Проверяем VIP и Dungeon Immunity."""
        res_vip = inventory.buy_shop_item(self.user_id, "vip_badge", chat_id=self.chat_id)
        self.assertTrue(res_vip["success"])
        res_imm = inventory.buy_shop_item(self.user_id, "dungeon_immunity", chat_id=self.chat_id)
        self.assertTrue(res_imm["success"])

        perks = inventory.get_user_perks(self.user_id, chat_id=self.chat_id)
        self.assertTrue(perks["vip"])
        self.assertTrue(perks["immunity"])
        self.assertGreater(perks["vip_days_left"], 0)
        self.assertGreater(perks["immunity_days_left"], 0)
        print("✓ Long-term perks (VIP and Dungeon Immunity) verified.")

    def test_05_mood_override_and_paranoia(self):
        """Проверяем установку настроения и режима паранойи."""
        res_mood = inventory.buy_shop_item(self.user_id, "mood_override", chat_id=self.chat_id, extra_data={"mood": "gachi"})
        self.assertTrue(res_mood["success"])
        override = inventory.get_chat_mood_override(self.chat_id)
        self.assertIsNotNone(override)
        self.assertEqual(override["mood"], "gachi")

        res_paranoia = inventory.buy_shop_item(self.user_id, "paranoia_mode", chat_id=self.chat_id)
        self.assertTrue(res_paranoia["success"])
        override2 = inventory.get_chat_mood_override(self.chat_id)
        self.assertIsNotNone(override2)
        self.assertIn("паранойи", override2["mood"])
        print("✓ Mood override and paranoia mode verified.")

    @patch("chat_manager._generate_and_send")
    @patch("chat_manager.bot.send_chat_action")
    def test_06_instant_shop_action_all_items(self, mock_action, mock_gen):
        """Проверяем, что execute_shop_action_instantly обрабатывает ВСЕ 14 предметов без исключений."""
        mock_gen.return_value = True

        # Пре-инициализируем chat_states чтобы не триггерить сетевой запрос к LLM
        chat_manager.chat_states[self.chat_id] = {
            'full_name': 'Тестовый Персонаж',
            'desc': 'Тестовый Архетип',
            'story_turn': 1,
            'message_count': 0,
            'date': '2026-11-17',
        }
        chat_manager.chat_goals[self.chat_id] = 'Тестовая цель'

        all_items = [
            ("vip_badge", {}),
            ("slap_friend", {"target_user": "Билли", "reason": "за пропуск тренировки"}),
            ("custom_roast", {"target_user": "Слейв", "hint": "не жмет сотку"}),
            ("golden_fart", {}),
            ("silent_muter", {}),
            ("compliment_bomb", {"target_user": "Ван", "compliment": "мощные банки"}),
            ("dungeon_party", {}),
            ("fake_ban", {"target_user": "Джаброни", "reason": "слишком дерзкий"}),
            ("bot_whisper", {"whisper_text": "в раздевалке завелся призрак"}),
            ("paranoia_mode", {}),
            ("shout_announcement", {"text": "Всем построиться!"}),
            ("dungeon_immunity", {}),
            ("mood_override", {"mood": "cyberpunk"}),
            ("custom_title", {"title": "Master of Gym"}),
        ]

        for item_id, extra_data in all_items:
            success = chat_manager.execute_shop_action_instantly(
                chat_id=self.chat_id,
                buyer_id=self.user_id,
                buyer_name="Босс",
                item_id=item_id,
                extra_data=extra_data
            )
            self.assertTrue(success, f"execute_shop_action_instantly failed for item: {item_id}")
            self.assertTrue(mock_gen.called, f"_generate_and_send was not called for item: {item_id}")
            mock_gen.reset_mock()
        print("✓ Instant action handler tested for all 14 items.")

if __name__ == "__main__":
    unittest.main()
