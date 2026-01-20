using MusicTheory.API.Models.DTOs.User;

namespace MusicTheory.API.Services;

public interface IUserService
{
    Task<UserDto?> GetByIdAsync(Guid id);
    Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest request);
}
