#!/usr/bin/env python3
"""重置 SnowLuma WebUI 密码

SnowLuma 使用 scrypt (非 PBKDF2!) 哈希密码：
  - passwordHash: scryptSync 输出，64字节 → 128位 hex
  - passwordSalt: 16字节原始随机数 → 32位 hex
"""
import hashlib
import os
import json
import sys

# Scrypt 参数（对应 auth.ts 中的 SCRYPT_KEYLEN=64, N=16384, r=8, p=1）
def scrypt_hash(password: str, salt_hex: str) -> str:
    salt_bytes = bytes.fromhex(salt_hex)
    dk = hashlib.scrypt(
        password.encode('utf-8'),
        salt=salt_bytes,
        n=16384,   # SCRYPT_N
        r=8,       # SCRYPT_R
        p=1,       # SCRYPT_P
        dklen=64   # SCRYPT_KEYLEN → 128 hex chars
    )
    return dk.hex()  # 64字节 → 128字符 hex

def main():
    if len(sys.argv) < 2:
        print("用法: python reset_password.py <新密码>")
        sys.exit(1)

    new_password = sys.argv[1]
    salt_hex = os.urandom(16).hex()  # 16字节 → 32位 hex
    hash_hex = scrypt_hash(new_password, salt_hex)

    config_path = r"D:\snowluma\config\webui.json"
    with open(config_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    cfg['passwordHash'] = hash_hex   # 128位 hex
    cfg['passwordSalt'] = salt_hex   # 32位 hex
    cfg['mustChangePassword'] = False

    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    print(f"密码已重置为: {new_password}")
    print(f"请重启 SnowLumaTray 使配置生效")

if __name__ == '__main__':
    main()
