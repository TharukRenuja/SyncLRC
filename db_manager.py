import os
import re
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

class DatabaseManager:
    def __init__(self):
        self.clients = []
        self._initialize_clients()
        self.current_write_index = 0

    def _initialize_clients(self):
        """
        Dynamically loads all SUPABASE_URL_X and SUPABASE_KEY_X pairs from .env
        """
        env_vars = os.environ.keys()
        # Find all keys matching SUPABASE_URL_(\d+)
        url_keys = [k for k in env_vars if k.startswith("SUPABASE_URL_")]
        
        # Sort them by the number at the end to ensure order
        url_keys.sort(key=lambda x: int(x.split("_")[-1]))

        for url_key in url_keys:
            index = url_key.split("_")[-1]
            key_var = f"SUPABASE_KEY_{index}"
            
            url = os.getenv(url_key)
            key = os.getenv(key_var)

            if url and key:
                if "your-project" in url:
                     print(f"Skipping placeholder credentials for Client {index}")
                     continue
                try:
                    client = create_client(url, key)
                    self.clients.append(client)
                    print(f"✅ Initialized Supabase Client {index}")
                except Exception as e:
                    print(f"❌ Failed to initialize Supabase Client {index}: {e}")
            else:
                print(f"⚠️ Missing key or url for Client {index} (Check .env)")

        if not self.clients:
            print("\n" + "="*50)
            print("❌ CRITICAL WARNING: No Supabase clients initialized!")
            print("   Caching will be DISABLED.")
            print("="*50 + "\n")

    def get_lyrics(self, track: str, artist: str, lyrics_type: str = None):
        """
        Iterates through all databases to find the requested lyrics.
        """
        if not self.clients:
            return None

        for i, client in enumerate(self.clients):
            try:
                query = client.table("lyrics").select("*").eq("name", track).eq("artist", artist)
                
                if lyrics_type:
                    query = query.eq("type", lyrics_type)
                
                response = query.execute()

                if response.data and len(response.data) > 0:
                    print(f"Found lyrics in DB {i+1}")
                    return response.data[0]
                    
            except Exception as e:
                print(f"Error reading from DB {i+1}: {e}")
                continue
        
        return None

    def save_lyrics(self, data: dict):
        """
        Tries to save lyrics to the current write DB. 
        If it fails (e.g. database full/error), rotates to the next one.
        """
        if not self.clients:
            return False

        attempts = 0
        total_clients = len(self.clients)

        while attempts < total_clients:
            client = self.clients[self.current_write_index]
            try:
                client.table("lyrics").upsert(data).execute()
                print(f"Saved | {data['name']} - {data['artist']} | {data['type']}")
                return True
            except Exception as e:
                print(f"Error saving to DB {self.current_write_index + 1}: {e}")
                print("Rotating to next database...")
                self.current_write_index = (self.current_write_index + 1) % total_clients
                attempts += 1
        
        print("Failed to save lyrics to any database.")
        return False
