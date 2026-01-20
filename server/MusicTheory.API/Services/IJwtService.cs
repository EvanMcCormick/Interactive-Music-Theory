using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services;

public interface IJwtService
{
    string GenerateAccessToken(User user);
    RefreshToken GenerateRefreshToken(Guid userId);
    Guid? ValidateAccessToken(string token);
}
