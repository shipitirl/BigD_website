import os

def generate_env_js():
    api_key = ""
    model = "gpt-3.5-turbo" # Default
    
    # Try to read .env manually since it's just a file
    try:
        with open('.env', 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('OPENAI_API_KEY='):
                    val = line.split('=', 1)[1]
                    api_key = val.strip("'\"")
                elif line.startswith('OPENAI_MODEL='):
                    val = line.split('=', 1)[1]
                    model = val.strip("'\"")
                    
    except FileNotFoundError:
        print("No .env file found.")
        return

    if not api_key:
        print("No OPENAI_API_KEY found in .env")
        return

    # Write to env.js
    content = f"""// Auto-generated from .env
window.ENV = {{
    OPENAI_API_KEY: "{api_key}",
    OPENAI_MODEL: "{model}"
}};
"""
    with open('env.js', 'w') as f:
        f.write(content)
    print(f"Successfully generated env.js (Model: {model})")

if __name__ == "__main__":
    generate_env_js()
